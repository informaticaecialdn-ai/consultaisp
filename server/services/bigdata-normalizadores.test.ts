/**
 * Trava os consertos que sairam da medicao de 27-28/08/2026 contra a API real.
 *
 * Cada caso aqui nasceu de um dado que CHEGAVA da BigData e que o codigo lia
 * errado — nao de dado que faltava. Sao regressoes silenciosas por natureza: se
 * a leitura voltar a ser a antiga, nada quebra, a tela so passa a mostrar zero
 * de novo. Por isso os payloads abaixo sao copias reduzidas do retorno real.
 */
import { describe, it, expect } from "vitest";
import {
  normalizarInadimplencia, normalizarCapacidade, normalizarDomicilio,
} from "./bigdata.service";

describe("normalizarInadimplencia · naturezas de execucao", () => {
  // Type real devolvido pela API para um CPF da carteira que tinha penhora
  // online (SISBAJUD, 2025). A lista antiga nao continha esta natureza, entao
  // `temExecucao` ficava falso com o processo na mao.
  const cumprimento = {
    Lawsuits: [{ Type: "CUMPRIMENTO DE SENTENCA", Status: "ARQUIVADO", CourtType: "CIVEL" }],
    TotalLawsuits: 1, TotalLawsuitsAsDefendant: 1,
  };

  it("reconhece cumprimento de sentenca como execucao", () => {
    const r = normalizarInadimplencia({}, cumprimento, {});
    expect(r.temExecucao).toBe(true);
  });

  it("reconhece a grafia com cedilha", () => {
    const r = normalizarInadimplencia({}, {
      ...cumprimento,
      Lawsuits: [{ Type: "CUMPRIMENTO DE SENTENÇA", Status: "ATIVO" }],
    }, {});
    expect(r.temExecucao).toBe(true);
  });

  it("continua reconhecendo execucao de titulo extrajudicial", () => {
    const r = normalizarInadimplencia({}, {
      Lawsuits: [{ Type: "EXECUCAO DE TITULO EXTRAJUDICIAL" }],
      TotalLawsuitsAsDefendant: 1,
    }, {});
    expect(r.temExecucao).toBe(true);
  });

  it("nao chama de execucao um processo em que a pessoa nao e re", () => {
    // Executar alguem nao diz nada sobre pagar as proprias contas.
    const r = normalizarInadimplencia({}, { ...cumprimento, TotalLawsuitsAsDefendant: 0 }, {});
    expect(r.temExecucao).toBe(false);
  });

  it("inventario e tutela nao sao cobranca de divida", () => {
    const r = normalizarInadimplencia({}, {
      Lawsuits: [{ Type: "INVENTARIO" }, { Type: "TUTELA E CURATELA" }],
      TotalLawsuitsAsDefendant: 2,
    }, {});
    expect(r.temExecucao).toBe(false);
  });
});

describe("normalizarCapacidade · beneficio social vem do bloco familiar", () => {
  // Domicilio real de Ibipora: 3 membros, 1 recebendo hoje, R$ 600 no
  // trimestre e R$ 4.200 em 12 meses. O dataset individual, que saiu do combo,
  // dizia IsReceivingAssistance=false para este mesmo CPF.
  const familiaComBeneficio = {
    TotalMembers: 3, TotalBeneficiaries: 4, TotalCurrentBeneficiaries: 1,
    FamilyAvgIncomeRange: "ATE 2 SM",
    AssistanceIncomePercentageRange: "SEM INFORMACAO",
    AssistancesIncomeHistory: { Last3Months: 600, Last12Months: 4200 },
  };

  it("marca que recebe beneficio quando ha beneficiario ativo na casa", () => {
    const c = normalizarCapacidade({}, familiaComBeneficio);
    expect(c.recebeBeneficio).toBe(true);
    expect(c.beneficiariosNaFamilia).toBe(1);
  });

  it("traz o valor em reais, que e o que separa hoje de 2020", () => {
    const c = normalizarCapacidade({}, familiaComBeneficio);
    expect(c.beneficioUltimos3m).toBe(600);
    expect(c.beneficioUltimos12m).toBe(4200);
  });

  it("casa que ja recebeu mas nao recebe hoje nao conta como recebendo", () => {
    const c = normalizarCapacidade({}, {
      TotalMembers: 6, TotalBeneficiaries: 4, TotalCurrentBeneficiaries: 0,
      AssistancesIncomeHistory: { Last3Months: 0, Last12Months: 0 },
    });
    expect(c.recebeBeneficio).toBe(false);
    expect(c.beneficiariosHistoricos).toBe(4);
  });

  it("descarta SEM INFORMACAO em vez de exibir a string crua", () => {
    const c = normalizarCapacidade(
      { MonthlyFreeBudgetRange: "SEM INFORMACAO" },
      { FamilyAvgIncomeRange: "SEM INFORMACAO" },
    );
    expect(c.sobraMensal).toBeUndefined();
    expect(c.rendaMediaFamiliar).toBeUndefined();
  });

  it("le o tamanho do domicilio do bloco familiar", () => {
    expect(normalizarCapacidade({}, familiaComBeneficio).pessoasNaCasa).toBe(3);
  });

  it("aceita o envelope nomeado da API alem do bloco cru", () => {
    const c = normalizarCapacidade(
      { FamilyFinancialData: { DependentsNumber: 2 } },
      { FamilySocialAssistance: familiaComBeneficio },
    );
    expect(c.dependentes).toBe(2);
    expect(c.pessoasNaCasa).toBe(3);
  });
});

describe("normalizarDomicilio · o tamanho da casa nao vem de related_people", () => {
  // TotalHousehold e TotalNeighbors vieram ZERO em 8 de 8 CPFs medidos; o
  // painel exibia dois zeros constantes como se fossem medicao.
  const relacionados = {
    TotalRelationships: 12, TotalHousehold: 0, TotalNeighbors: 0,
    TotalRelatives: 5, TotalSpouses: 1, TotalCoworkers: 6, TotalPartners: 0,
    PersonalRelationships: [
      { RelatedEntityName: "MARIA DA SILVA", RelationshipType: "MOTHER", RelationshipLevel: "DIRECT" },
    ],
  };

  it("usa o numero de membros que vem por parametro, nao o TotalHousehold", () => {
    const d = normalizarDomicilio(relacionados, false, 6);
    expect(d.noDomicilio).toBe(6);
  });

  it("preserva os contadores de parentesco, que chegam de verdade", () => {
    const d = normalizarDomicilio(relacionados, false, 6);
    expect(d.parentes).toBe(5);
    expect(d.conjuges).toBe(1);
    expect(d.colegasTrabalho).toBe(6);
    expect(d.totalRelacionados).toBe(12);
  });

  it("sem ocorrencia no domicilio, nome de terceiro nao aparece", () => {
    const d = normalizarDomicilio(relacionados, false, 3);
    expect(d.nomes).toEqual([]);
    expect(d.nomesLiberados).toBe(false);
  });

  it("com ocorrencia, os nomes abrem — e a tela sabe explicar por que", () => {
    const d = normalizarDomicilio(relacionados, true, 3);
    expect(d.nomes).toHaveLength(1);
    expect(d.nomes[0]).toMatchObject({ vinculo: "MOTHER", nivel: "DIRECT" });
    expect(d.nomesLiberados).toBe(true);
  });
});
