import { describe, it, expect } from "vitest";
import {
  NIVEIS, NIVEL_PADRAO, DATASETS, DATASETS_FORA_DE_USO, PRECO_DA_CONTA, custoDoCombo, extrasDoNivel, normalizarPerfil, normalizarTelefoneValidado, normalizarImovel, normalizarProcessosDetalhe,
  type NivelConsulta,
} from "./bigdata.service";

const IDS = Object.keys(NIVEIS) as NivelConsulta[];

describe("níveis de consulta", () => {
  it("o padrão é o mais barato e existe na tabela", () => {
    expect(NIVEIS[NIVEL_PADRAO]).toBeDefined();
    const maisBarato = IDS.reduce((a, b) => NIVEIS[a].creditos <= NIVEIS[b].creditos ? a : b);
    expect(maisBarato).toBe(NIVEL_PADRAO);
  });

  /** Níveis do mais barato ao mais caro — sem citar nome, para o teste
   *  continuar valendo se um nível for adicionado ou removido. */
  const porPreco = [...IDS].sort((a, b) => NIVEIS[a].creditos - NIVEIS[b].creditos);

  it("cada nível contém tudo do anterior — nunca perde dado ao subir", () => {
    for (let i = 1; i < porPreco.length; i++) {
      const barato = new Set(NIVEIS[porPreco[i - 1]].datasets);
      const caro = new Set(NIVEIS[porPreco[i]].datasets);
      for (const d of barato) {
        expect(caro.has(d), `${porPreco[i]} perdeu ${d} que existe em ${porPreco[i - 1]}`).toBe(true);
      }
      expect(caro.size).toBeGreaterThan(barato.size);
    }
  });

  it("nenhum nível repete dataset — repetir é pagar duas vezes", () => {
    for (const id of IDS) {
      const lista = NIVEIS[id].datasets;
      expect(new Set(lista).size, `nível ${id} tem dataset duplicado`).toBe(lista.length);
    }
  });

  it("nenhum dataset descartado vaza para um nível", () => {
    // Todo dataset listado vira cobrança assim que o provedor habilita no BDC
    // Center. Os de DATASETS_FORA_DE_USO cobram sem entregar nada útil aqui.
    for (const id of IDS) {
      for (const proibido of DATASETS_FORA_DE_USO) {
        expect(
          NIVEIS[id].datasets.includes(proibido),
          `${proibido} não pode estar no nível ${id}`,
        ).toBe(false);
      }
    }
  });

  it("os dois datasets Quod de risco não convivem — um é superconjunto do outro", () => {
    for (const id of IDS) {
      const tem = (n: string) => NIVEIS[id].datasets.includes(n);
      expect(
        tem("partner_quod_credit_risk_person") && tem("partner_quod_credit_risk_details_person"),
        `nível ${id} pede os dois envelopes QUODCreditRiskPerson`,
      ).toBe(false);
    }
  });

  it("o padrão é exatamente o combo nativo, sem bureau pago", () => {
    expect(NIVEIS.padrao.datasets).toEqual(DATASETS);
    expect(NIVEIS.padrao.datasets.some(d => d.startsWith("partner_"))).toBe(false);
  });

  it("créditos e custo sobem juntos", () => {
    for (let i = 1; i < porPreco.length; i++) {
      const a = NIVEIS[porPreco[i - 1]], b = NIVEIS[porPreco[i]];
      expect(a.creditos).toBeLessThan(b.creditos);
      expect(a.custoBrl).toBeLessThan(b.custoBrl);
    }
  });

  it("extrasDoNivel isola o que cada nível cobra além do padrão — hoje, nada", () => {
    expect(extrasDoNivel(NIVEL_PADRAO)).toEqual([]);
    for (const id of IDS) {
      const extras = extrasDoNivel(id);
      // Só bureau pago pode ser extra; nativo já está no padrão.
      expect(extras.every(d => d.startsWith("partner_"))).toBe(true);
      for (const d of extras) expect(DATASETS.includes(d as any)).toBe(false);
    }
  });

  it("os créditos cobrados cobrem o custo da BigData", () => {
    // Com o crédito vendido a R$ 1,00 isso empata. Se um nível cobrar menos
    // créditos que o custo em reais, ele dá prejuízo em qualquer preço de pacote.
    for (const id of IDS) {
      expect(
        NIVEIS[id].creditos,
        `nível ${id} cobra ${NIVEIS[id].creditos} créditos para um custo de R$ ${NIVEIS[id].custoBrl}`,
      ).toBeGreaterThanOrEqual(Math.floor(NIVEIS[id].custoBrl));
    }
  });

  it("todo nível tem rótulo e descrição para a tela", () => {
    for (const id of IDS) {
      expect(NIVEIS[id].rotulo.length).toBeGreaterThan(0);
      expect(NIVEIS[id].descricao.length).toBeGreaterThan(0);
    }
  });

  it("o custo do padrão é a soma medida dos 14 datasets — R$ 0,72 em 02/09/2026", () => {
    expect(NIVEIS.padrao.datasets).toHaveLength(14);
    expect(custoDoCombo(DATASETS)).toBe(0.72);
    expect(NIVEIS.padrao.custoBrl).toBe(custoDoCombo(DATASETS));
    for (const d of DATASETS) expect(PRECO_DA_CONTA[d], d).toBeGreaterThan(0);
  });

  it("o padrão custa 1 crédito e os seis cortados em 02/09/2026 não voltaram", () => {
    expect(NIVEIS.padrao.creditos).toBe(1);
    for (const fora of ["address_risk", "demographic_data", "financial_data", "emails_extended", "family_financial_risk", "family_social_assistance"]) {
      expect(DATASETS as readonly string[], fora).not.toContain(fora);
    }
  });
});

describe("normalizarPerfil (demographic_data)", () => {
  // Payload real da consulta 32, que voltava Code 0 e mesmo assim rendia {}.
  const real = [
    {
      DataOrigin: "MTE", DataAgregationLevel: "CITY", SocialClass: "",
      EstimatedIncomeRange: "2 - 2 A 4 SM", EstimatedInstructionLevel: "05 - FUND COMPL",
    },
    {
      DataOrigin: "IBGE", DataAgregationLevel: "CENSUS SECTOR", SocialClass: "",
      EstimatedIncomeRange: "2 - 2 A 4 SM",
      EstimatedInstructionLevel: "07 - REGULAR DO ENSINO FUNDAMENTAL OU 1 GRAU",
    },
  ];

  it("lê o array e tira o código do prefixo", () => {
    const p = normalizarPerfil(real);
    expect(p.faixaRenda).toBe("2 A 4 SM");
    expect(p.escolaridade).toBe("REGULAR DO ENSINO FUNDAMENTAL OU 1 GRAU");
  });

  it("prefere o setor censitário ao município", () => {
    expect(normalizarPerfil(real).origem).toBe("setor censitário");
  });

  it("campo vazio vira undefined, não string vazia", () => {
    // SocialClass = "" nos dois: não pode virar chip vazio na tela.
    expect(normalizarPerfil(real).classeSocial).toBeUndefined();
  });

  it("preenche campo a campo — não descarta a entrada menos granular", () => {
    const misto = [
      { DataAgregationLevel: "CENSUS SECTOR", SocialClass: "", EstimatedIncomeRange: "3 - 4 A 10 SM" },
      { DataAgregationLevel: "CITY", SocialClass: "C", EstimatedIncomeRange: "" },
    ];
    const p = normalizarPerfil(misto);
    expect(p.faixaRenda).toBe("4 A 10 SM");
    expect(p.classeSocial).toBe("C");
  });

  it("aguenta objeto solto, array vazio e ausência", () => {
    expect(normalizarPerfil([])).toEqual({});
    expect(normalizarPerfil(undefined)).toEqual({});
    expect(normalizarPerfil({ SocialClass: "B" }).classeSocial).toBe("B");
  });

  it("SEM INFORMACAO não vira valor", () => {
    expect(normalizarPerfil([{ SocialClass: "SEM INFORMACAO" }]).classeSocial).toBeUndefined();
  });
});

describe("normalizarTelefoneValidado (telesign)", () => {
  // Payload do exemplo oficial da doc do dataset.
  const env = {
    PhoneType: "FIXED_LINE", Blocked: "Not blocked", Carrier: "Claro S.A.",
    Location: { City: "Rio De Janeiro", Country: "Brazil" },
  };

  it("lê tipo, operadora atual e bloqueio", () => {
    const v = normalizarTelefoneValidado(env, "(21) 33553575")!;
    expect(v.tipo).toBe("FIXED_LINE");
    expect(v.operadoraAtual).toBe("Claro S.A.");
    expect(v.bloqueado).toBe(false);
    expect(v.cidade).toBe("Rio De Janeiro");
  });

  it("Blocked diferente de 'Not blocked' vira bloqueado=true", () => {
    expect(normalizarTelefoneValidado({ ...env, Blocked: "Blocked" }, "x")!.bloqueado).toBe(true);
  });

  it("Blocked ausente fica indefinido — não inventa 'ativa'", () => {
    expect(normalizarTelefoneValidado({ PhoneType: "MOBILE" }, "x")!.bloqueado).toBeUndefined();
  });

  it("envelope ausente vira null", () => {
    expect(normalizarTelefoneValidado(undefined, "x")).toBeNull();
  });
});

describe("normalizarImovel (qualificação de endereço)", () => {
  // Payload do exemplo oficial da doc do dataset.
  const env = {
    Tipology: "APARTAMENTO", ResidenceType: "RESIDENCIAL",
    PropertyAreaInM2: 33, TotalRooms: 3, IsExactMatch: true,
  };

  it("lê tipologia, uso, área e cômodos", () => {
    const i = normalizarImovel(env, "Rua Farani, 3, Rio de Janeiro")!;
    expect(i.tipologia).toBe("APARTAMENTO");
    expect(i.uso).toBe("RESIDENCIAL");
    expect(i.areaM2).toBe(33);
    expect(i.comodos).toBe(3);
    expect(i.correspondenciaExata).toBe(true);
  });

  it("CEP+número sem correspondência exata fica marcado", () => {
    expect(normalizarImovel({ ...env, IsExactMatch: false }, "x")!.correspondenciaExata).toBe(false);
  });

  it("envelope ausente vira null", () => {
    expect(normalizarImovel(null, "x")).toBeNull();
  });
});

describe("sondas por nível", () => {
  it("o padrão não liga as sondas de telefone e imóvel", () => {
    expect(NIVEIS.padrao.sondas).toBe(false);
  });

  it("os datasets das sondas não entram na lista principal — o q deles não é doc{cpf}", () => {
    for (const id of IDS) {
      expect(NIVEIS[id].datasets).not.toContain("partner_telesign_phone_id_standard_person");
      expect(NIVEIS[id].datasets).not.toContain("partner_rede_vistorias_address");
    }
  });
});

describe("normalizarProcessosDetalhe", () => {
  // Estrutura real das consultas gravadas: Parties com Doc + Polarity.
  const CPF = "27720866827";
  const base = {
    Type: "EMBARGO A EXECUCAO", State: "PR", Status: "SUSPENSO", Value: -1,
    CourtName: "TJPR", NoticeDate: "2025-07-09T00:00:00",
    InferredCNJProcedureTypeName: "EMBARGOS À EXECUÇÃO",
    InferredBroadCNJSubjectName: "DIREITO DO CONSUMIDOR",
    Parties: [{ Doc: CPF, Polarity: "ACTIVE" }],
  };

  it("le tipo CNJ, assunto, tribunal e data", () => {
    const [p] = normalizarProcessosDetalhe({ Lawsuits: [base] }, CPF);
    expect(p.tipo).toBe("EMBARGOS À EXECUÇÃO");
    expect(p.assunto).toBe("DIREITO DO CONSUMIDOR");
    expect(p.tribunal).toBe("TJPR");
    expect(p.uf).toBe("PR");
    expect(p.data).toBe("2025-07-09T00:00:00");
  });

  it("polo passivo vira réu; ativo vira autor; sem parte vira outro", () => {
    const reu = { ...base, Parties: [{ Doc: CPF, Polarity: "PASSIVE" }] };
    const semParte = { ...base, Parties: [{ Doc: "99999999999", Polarity: "PASSIVE" }] };
    const [a] = normalizarProcessosDetalhe({ Lawsuits: [base] }, CPF);
    const [b] = normalizarProcessosDetalhe({ Lawsuits: [reu] }, CPF);
    const [c] = normalizarProcessosDetalhe({ Lawsuits: [semParte] }, CPF);
    expect(a.papel).toBe("autor");
    expect(b.papel).toBe("réu");
    expect(c.papel).toBe("outro");
  });

  it("Value -1 é 'não informado', nunca um valor", () => {
    const [p] = normalizarProcessosDetalhe({ Lawsuits: [base] }, CPF);
    expect(p.valor).toBeUndefined();
    const [q] = normalizarProcessosDetalhe({ Lawsuits: [{ ...base, Value: 3674.33 }] }, CPF);
    expect(q.valor).toBeCloseTo(3674.33);
  });

  it("ordena do mais recente para o mais antigo e limita a 15", () => {
    const muitos = Array.from({ length: 20 }, (_, i) => ({
      ...base, NoticeDate: `2020-01-${String(i + 1).padStart(2, "0")}T00:00:00`,
    }));
    const r = normalizarProcessosDetalhe({ Lawsuits: muitos }, CPF);
    expect(r.length).toBe(15);
    expect(r[0].data! > r[14].data!).toBe(true);
  });

  it("data zero do .NET nao vira data", () => {
    const [p] = normalizarProcessosDetalhe({
      Lawsuits: [{ ...base, NoticeDate: "0001-01-01T00:00:00", LastMovementDate: "2026-01-26T00:00:00" }],
    }, CPF);
    expect(p.data).toBe("2026-01-26T00:00:00");
  });

  it("sem processos devolve lista vazia", () => {
    expect(normalizarProcessosDetalhe({}, CPF)).toEqual([]);
    expect(normalizarProcessosDetalhe(undefined, CPF)).toEqual([]);
  });
});
